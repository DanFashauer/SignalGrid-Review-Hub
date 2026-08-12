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
  // `defaults read` writes its FAILURE to stdout as an ordinary string, so a
  // missing key arrives here looking exactly like data:
  //
  //   "2026-07-31 19:25:53.687 defaults[79610:19689790] \n
  //    The domain/default pair of (…XProtect.bundle/Contents/Info, Version)
  //    does not exist"
  //
  // MEASURED on the owner's Mac through the live signalgrid-mcp server, not
  // hypothesised: that blob is non-empty and contains no "%", so it survived every
  // check above and `malwareDefs()` graded it "present" — i.e. a message stating
  // the XProtect version key DOES NOT EXIST was read as "definitions are present",
  // and xprotect never appeared in controlsUnknown. Absence read as good news, in
  // the live path.
  //
  // Both shapes are matched: the timestamped `defaults[pid:tid]` stderr banner, and
  // the "does not exist" sentence on its own in case the banner is stripped.
  if (/\bdefaults\[\d+:[0-9a-f]+\]/i.test(s)) return null;
  if (/\bdoes not exist\b/i.test(s)) return null;
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
 * Fold an optional system_extensions section (from signalgrid_system_extensions)
 * into three fail-safe fields. Distinguishes three cases:
 *  - section ABSENT → not assessed; contributes nothing (residual/conflict null,
 *    unreliable false). We do not raise the bar for a signal we never claimed.
 *  - section present but available/reliable false, or counts unreadable →
 *    unreliable=true (raises the bar), counts null.
 *  - section present and trustworthy → residual count + conflict boolean.
 */
function normalizeSysext(sxRaw: unknown): {
  residual: number | null;
  conflict: boolean | null;
  unreliable: boolean;
} {
  // ONLY a truly absent section is "not assessed". Any present-but-degraded value
  // (null, a string, a number — a section that couldn't produce an object) must
  // raise the bar, not pass silently.
  if (sxRaw === undefined) return { residual: null, conflict: null, unreliable: false };
  if (sxRaw === null || typeof sxRaw !== "object") return { residual: null, conflict: null, unreliable: true };
  const sx = sxRaw as { available?: unknown; reliable?: unknown; residual_count?: unknown; extensions?: unknown };
  if (sx.available !== true || sx.reliable !== true) {
    return { residual: null, conflict: null, unreliable: true };
  }
  // A residual count must be a non-negative integer; a sentinel (-1) / NaN / non-number
  // is unreadable, not zero.
  const rc = sx.residual_count;
  const residual = typeof rc === "number" && Number.isInteger(rc) && rc >= 0 ? rc : null;
  // Conflict needs the extension list. If it's not a readable array we CANNOT
  // assert "no conflict" — asserting false would be a silent pass. Mark it
  // unassessable (conflict null) and raise the bar.
  if (!Array.isArray(sx.extensions)) {
    return { residual, conflict: null, unreliable: true };
  }
  // A conflict is 2+ ENABLED, ACTIVE endpoint-security extensions (two EDRs fighting).
  // Consumes the MCP tool's normalized status ("active"); compared case-insensitively.
  const activeEndpointSecurity = sx.extensions.filter((e): boolean => {
    if (!e || typeof e !== "object") return false;
    const x = e as { category?: unknown; status?: unknown; enabled?: unknown };
    return (
      typeof x.category === "string" && x.category.toLowerCase().includes("endpoint_security") &&
      String(x.status).toLowerCase() === "active" && x.enabled === true
    );
  }).length;
  const conflict = activeEndpointSecurity >= 2;
  // reliable claimed but the count is unreadable/invalid → still fail-safe.
  if (residual === null) return { residual: null, conflict, unreliable: true };
  return { residual, conflict, unreliable: false };
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
  const sysext = normalizeSysext(report.system_extensions);
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
    sysextResidual: sysext.residual,
    sysextConflict: sysext.conflict,
    sysextUnreliable: sysext.unreliable,
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
