// Read-only normalization + transport for the macOS endpoint-posture connector.
//
// The "transport" here is deliberately thin: the real source is the on-device
// `signalgrid-mcp` server (stdio), whose posture-report JSON is forwarded to the
// fabric by a bridge. This connector NORMALIZES that report and, in live mode,
// fetches it from a bridge endpoint. Fixture-safe by default (no network unless a
// real bridge is configured). Every operation is a read — there is no write path.

import {
  MacosPostureConnectorError,
  type MacosControl,
  type MacosDefsState,
  type MacosPostureReportRaw,
  type NormalizedMacosPosture,
} from "./types";

/** A GET-only guard, mirroring the other connectors — a non-GET is a bug. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new MacosPostureConnectorError(
      "read_only_violation",
      `macOS posture is read-only; refused ${method}`,
    );
  }
}

/** true → "on", false → "off", anything else (null/undefined/non-bool) → "unknown". */
function control(v: unknown): MacosControl {
  if (v === true) return "on";
  if (v === false) return "off";
  return "unknown";
}

/** A string field that macOS collectors fill with "not found: …" / "error" /
 *  "unavailable" sentinels when a probe can't run — those normalize to null. */
function readableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const lower = s.toLowerCase();
  if (lower.startsWith("not found") || lower.startsWith("unavailable") || lower.startsWith("error")) {
    return null;
  }
  // Some probes prefix a Python exception name (e.g. "FileNotFoundError: …").
  if (/^[a-z]+error\b/i.test(s)) return null;
  // A `defaults`/`stat` format artifact that was never substituted (e.g. "%Su",
  // "%N") is not a real value — treat it as unknown, never a fabricated reading.
  if (s.includes("%")) return null;
  return s;
}

function malwareDefs(v: unknown): MacosDefsState {
  return readableString(v) === null ? "unknown" : "present";
}

/**
 * Fold macOS auto-update settings into one control. If the device won't even
 * CHECK for updates it is effectively off; if checking is enabled it is on; if the
 * relevant flags could not be read it is unknown (never silently "on").
 */
function autoUpdate(updates: MacosPostureReportRaw["updates"]): MacosControl {
  if (!updates || typeof updates !== "object") return "unknown";
  const check = updates.AutomaticCheckEnabled;
  const install = updates.AutomaticallyInstallMacOSUpdates;
  if (check === false) return "off";
  if (check === true || install === true) return "on";
  return "unknown";
}

/**
 * Normalize a raw signalgrid-mcp posture report into the fabric's shape.
 * `deviceId` is supplied by the collector context (the report itself is about
 * "this Mac"); `source` labels the bridge/collector. Defensive throughout: a
 * missing or errored section yields `unknown`, never a fabricated "on".
 */
export function normalizeReport(
  deviceId: string,
  report: MacosPostureReportRaw,
  source = "signalgrid-mcp",
): NormalizedMacosPosture {
  const sec = report.security ?? {};
  const mdm = report.mdm ?? {};
  const os = report.os ?? {};
  return {
    sourceSystem: "macos-posture",
    deviceId,
    osVersion: readableString(os.product_version),
    sip: control(sec.sip?.enabled),
    fileVault: control(sec.filevault?.enabled),
    gatekeeper: control(sec.gatekeeper?.enabled),
    firewall: control(sec.firewall?.enabled),
    mdmEnrolled: typeof mdm.mdm_enrolled === "boolean" ? mdm.mdm_enrolled : null,
    autoUpdate: autoUpdate(report.updates),
    malwareDefs: malwareDefs(report.xprotect?.xprotect_definitions),
    source,
  };
}

/** A read-only bridge request: which device, and the token to present. */
export interface MacosReportRequest {
  deviceId: string;
  token: string;
}

/** Fetch a device's raw posture report from a bridge. Injectable so tests and the
 *  fixture path never touch the network. The token travels with the request so a
 *  bad credential is a real auth failure, not a silent pass. */
export type MacosReportTransport = (req: MacosReportRequest) => Promise<MacosPostureReportRaw>;

export interface MacosPostureConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Live connector: pulls a raw report from a bridge (read-only) and normalizes it.
 *  In practice the bridge relays the on-device MCP server's output. */
export class MacosPostureConnector {
  constructor(
    private readonly config: MacosPostureConnectorConfig,
    private readonly transport: MacosReportTransport,
  ) {}

  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof MacosPostureConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchPosture(deviceId: string): Promise<NormalizedMacosPosture> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
