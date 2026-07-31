// Benchmark-selection family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, committed catalog snapshot, proof, and no write
// path of any kind.
//
// READING AN ASSESSMENT IS NOT PERFORMING ONE. This family consumes a grading run
// that a scanner, UEM, or compliance tool already performed and grades its shape and
// provenance. SignalGrid launches no scan, re-grades no rule, reads no benchmark
// content, and claims no CIS certification, conformance, or partnership.

import {
  BenchmarkSelectionConnector,
  type BenchmarkSelectionConnectorConfig,
  type BenchmarkSelectionTransport,
} from "./benchmark-selection-connector";
import { BenchmarkSelectionConnectorError, type BenchmarkSelectionReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./benchmark-selection-connector";
export {
  loadBenchmarkCatalog,
  buildBenchmarkCatalog,
  versionGreater,
  type BenchmarkCatalog,
  type CatalogEntry,
} from "./catalog";
export {
  createMockBenchmarkSelectionTransport,
  type MockBenchmarkSelectionOptions,
} from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true
 * AND BENCHMARK_SELECTION_ACCESS_TOKEN. Otherwise fixture mode.
 */
export type BenchmarkSelectionConnectorResolution =
  | { mode: "live"; connector: BenchmarkSelectionConnector }
  | { mode: "fixture"; reason: string };

export function resolveBenchmarkSelectionConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: BenchmarkSelectionTransport,
): BenchmarkSelectionConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.BENCHMARK_SELECTION_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "BENCHMARK_SELECTION_ACCESS_TOKEN is not set" };
  }
  const config: BenchmarkSelectionConnectorConfig = {
    accessToken,
    baseUrl: env.BENCHMARK_SELECTION_BASE_URL?.trim() || "https://benchmark-assessor.local/assessments",
    source: "benchmark-selection-assessor",
  };
  return {
    mode: "live",
    connector: new BenchmarkSelectionConnector(
      config,
      transportOverride ?? makeDefaultBenchmarkSelectionTransport(config.baseUrl),
    ),
  };
}

/** Build a live assessor transport bound to a specific base URL (honors config). */
export function makeDefaultBenchmarkSelectionTransport(baseUrl: string): BenchmarkSelectionTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new BenchmarkSelectionConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `benchmark-selection source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new BenchmarkSelectionConnectorError("bad_response", "benchmark-selection source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BenchmarkSelectionConnectorError("bad_response", "benchmark-selection source returned a non-object body", res.status);
    }
    return body as BenchmarkSelectionReportRaw;
  };
}
