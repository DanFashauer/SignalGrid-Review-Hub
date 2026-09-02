// Read-only normalization + transport for the OT / IIoT edge-device connector.
//
// The source is an edge gateway that observes the OT device (it cannot run an
// agent on a PLC). This connector normalizes the gateway's read-only report and,
// in live mode, fetches it from a bridge. Fixture-safe by default. Every
// operation is a read — there is no write path to the plant floor.

import {
  OtConnectorError,
  type OtDeviceReportRaw,
  type OtFirmware,
  type OtGatewayLiveness,
  type OtSegmentation,
  type NormalizedOtPosture,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new OtConnectorError("read_only_violation", `OT posture is read-only; refused ${method}`),
);

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

function readableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const lower = s.toLowerCase();
  if (lower.startsWith("not found") || lower.startsWith("unavailable") || lower.startsWith("error")) return null;
  return s;
}

/** Normalize an edge-gateway OT report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown, never a fabricated "secure". */
export function normalizeReport(
  deviceId: string,
  report: OtDeviceReportRaw,
  source = "edge-gateway",
): NormalizedOtPosture {
  const fw = report.firmware ?? {};
  const net = report.network ?? {};
  const gw = report.gateway ?? {};
  return {
    sourceSystem: "ot-posture",
    deviceId,
    deviceType: readableString(report.deviceType),
    firmware: oneOf<OtFirmware>(fw.status, ["current", "outdated", "eol", "unknown"], "unknown"),
    patchable: typeof fw.patchable === "boolean" ? fw.patchable : null,
    segmentation: oneOf<OtSegmentation>(net.segmentation, ["segmented", "flat", "unknown"], "unknown"),
    insecureProtocolExposed: typeof net.insecure_protocol_exposed === "boolean" ? net.insecure_protocol_exposed : null,
    gatewayLiveness: oneOf<OtGatewayLiveness>(gw.liveness, ["live", "stale", "unknown"], "unknown"),
    source,
  };
}

export interface OtReportRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's raw report from a bridge. Injectable so tests/fixtures never
 *  touch the network. The token travels with the request (real auth failures). */
export type OtReportTransport = (req: OtReportRequest) => Promise<OtDeviceReportRaw>;

export interface OtConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class OtPostureConnector {
  constructor(
    private readonly config: OtConnectorConfig,
    private readonly transport: OtReportTransport,
  ) {}

  /**
   * NOTE ON `status: null`. The success path returns null, NOT 200.
   *
   * This connector is handed an INJECTED transport that resolves a payload — there is
   * no HTTP response here and therefore no status code to read. The old `status: 200`
   * was invented: a 201, 202 or 204 upstream reported as 200, and a reviewer reading
   * the field believed a server had said it. `null` is the honest value — "the
   * transport resolved; no status was observed" — and the type can now say it.
   *
   * The failure path keeps a real number because the error carries one.
   *
   * NOT FIXED HERE, and stated so the remaining gap is not mistaken for closed:
   * `healthy: true` still means "the injected transport resolved", which in fixture
   * mode is true without anything being contacted. That fix belongs at the resolution
   * layer, which already reports `mode: "fixture"` with a reason — see the backlog.
   */
  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number | null }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: null };
    } catch (err) {
      const status = err instanceof OtConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchPosture(deviceId: string): Promise<NormalizedOtPosture> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
