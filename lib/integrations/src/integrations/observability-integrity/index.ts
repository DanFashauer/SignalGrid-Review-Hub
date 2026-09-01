// Observability-integrity family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A STREAM'S SELF-DESCRIPTION IS NOT OBSERVING ANYTHING. This family
// consumes the metadata an observability backend already keeps about its own
// collection — is this target up, what sample rate is in force, when did the last
// datapoint land — and grades how much weight that stream's silence can bear.
// SignalGrid instruments nothing, scrapes nothing, samples nothing, stores no
// telemetry and emits none. Collecting is the platform's job; deciding what its
// silence is worth is ours.
//
// The reference shapes are the open ones — an OpenTelemetry collector's pipeline
// state, a Prometheus/OpenMetrics scrape target's up-ness and scrape interval —
// because those are specified in public and can be implemented against without
// anyone's proprietary schema.

import {
  ObservabilityIntegrityConnectorError,
  type ObservabilityStreamReportRaw,
} from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./normalize";

/** Injected so every test and the proof drive the SAME code path the live call
 *  uses. A transport the tests replace wholesale would leave the real one never
 *  executed — the defect the shared live-gate harness exists to catch. */
export type ObservabilityIntegrityTransport = (args: {
  streamRef: string;
  token: string;
}) => Promise<ObservabilityStreamReportRaw>;

export type ObservabilityIntegrityResolution =
  | { mode: "live"; fetchStream: (streamRef: string) => Promise<ObservabilityStreamReportRaw> }
  | { mode: "fixture"; reason: string };

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with
 * SIGNALGRID_LIVE_INTEGRATIONS=true AND OBSERVABILITY_INTEGRITY_TOKEN. Otherwise
 * fixture mode. Every gate is checked INDEPENDENTLY so removing any one of them
 * falls back to fixtures — proven by the shared live-gate harness rather than
 * asserted here.
 */
export function resolveObservabilityIntegrityConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: ObservabilityIntegrityTransport,
): ObservabilityIntegrityResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const token = env.OBSERVABILITY_INTEGRITY_TOKEN?.trim();
  if (!token) {
    return { mode: "fixture", reason: "OBSERVABILITY_INTEGRITY_TOKEN is not set" };
  }
  const baseUrl =
    env.OBSERVABILITY_INTEGRITY_BASE_URL?.trim() || "https://observability.local/v1/streams";
  const transport = transportOverride ?? makeDefaultObservabilityIntegrityTransport(baseUrl);
  return { mode: "live", fetchStream: (streamRef) => transport({ streamRef, token }) };
}

/** Build a live observability-backend transport bound to a specific base URL. */
export function makeDefaultObservabilityIntegrityTransport(
  baseUrl: string,
): ObservabilityIntegrityTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ streamRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(streamRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new ObservabilityIntegrityConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `observability-integrity source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ObservabilityIntegrityConnectorError(
        "bad_response",
        "observability-integrity source returned a non-JSON body",
        res.status,
      );
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ObservabilityIntegrityConnectorError(
        "bad_response",
        "observability-integrity source returned a non-object body",
        res.status,
      );
    }
    return body as ObservabilityStreamReportRaw;
  };
}
