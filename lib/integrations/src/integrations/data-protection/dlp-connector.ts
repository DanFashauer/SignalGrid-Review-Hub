import {
  DlpConnectorError,
  type DataClass,
  type DataProtectionRaw,
  type DlpAction,
  type DlpChannel,
  type DlpCollection,
  type DlpViolationRaw,
  type NormalizedDataProtection,
  type NormalizedDlpViolation,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";
import { normalizeSeverity } from "../../utils/normalizeSeverity";

/**
 * Read-only data-protection / DLP connector. Reads per-device DLP policy state +
 * recent violations and normalizes them. READ-ONLY by construction (GET-only,
 * guarded) — it never quarantines a file, revokes a share, or changes a DLP
 * policy; those stay explicit, separately-authorized actions. Injectable
 * transport for offline proofs.
 */

export interface DlpRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface DlpHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type DlpTransport = (req: DlpRequest) => Promise<DlpHttpResponse>;

export interface DlpConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never mutate. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new DlpConnectorError("read_only_violation", `The data-protection connector is read-only; refused a ${method} request.`),
);

export class DataProtectionConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: DlpTransport;

  constructor(config: DlpConnectorConfig, transport: DlpTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.dlp.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/device-dlp?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listDevices(): Promise<DataProtectionRaw[]> {
    return this.getAllPages<DataProtectionRaw>(`${this.baseUrl}/device-dlp`);
  }

  async fetchDevices(): Promise<NormalizedDataProtection[]> {
    const devices = await this.listDevices();
    return devices.map(normalizeDevice);
  }

  private async getAllPages<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    let pages = 0;
    while (url && pages < this.pageLimit) {
      const res = await this.rawGet(url);
      if (!res.ok) throw errorFor(res.status);
      let body: DlpCollection<T>;
      try {
        body = (await res.json()) as DlpCollection<T>;
      } catch {
        throw new DlpConnectorError("bad_response", "Data-protection response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new DlpConnectorError("bad_response", "Data-protection collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    // Exiting the cap with a next-page cursor still in hand means the inventory is
    // INCOMPLETE, and a short list is indistinguishable from a complete one — for a
    // posture fabric, a device missing from the result reads as a device with no
    // problem. Refuse rather than pass a partial inventory off as a whole one; the
    // cap itself stays, because it is the loop/DoS guard against an endless cursor.
    if (url) {
      throw new DlpConnectorError(
        "incomplete_read",
        `DLP read hit the ${this.pageLimit}-page cap with more pages remaining. ` +
          "Refusing to return a partial inventory as if it were complete; raise pageLimit to read further.",
      );
    }
    return out;
  }

  private async rawGet(url: string): Promise<DlpHttpResponse> {
    const req: DlpRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): DlpConnectorError {
  if (status === 401 || status === 403) {
    return new DlpConnectorError("auth_failed", `DLP platform returned ${status}.`, status);
  }
  return new DlpConnectorError("upstream_error", `DLP platform returned HTTP ${status}.`, status);
}

export function normalizeDevice(device: DataProtectionRaw): NormalizedDataProtection {
  return {
    sourceSystem: "data-protection",
    deviceId: device.deviceId,
    dlpPolicyEnforced: typeof device.dlpPolicyEnforced === "boolean" ? device.dlpPolicyEnforced : null,
    // `?? []` here made "the source never reported this" indistinguishable from
    // "the source reported nothing". Absence is preserved and graded downstream.
    violations: device.violations == null ? null : device.violations.map(normalizeViolation),
    source: device.source ?? "unknown",
  };
}

export function normalizeViolation(v: DlpViolationRaw): NormalizedDlpViolation {
  const action = normalizeAction(v.action);
  const dataClass = normalizeDataClass(v.dataClass);
  return {
    violationId: v.violationId ?? null,
    channel: normalizeChannel(v.channel),
    action,
    severity: normalizeSeverity(v.severity),
    dataClass,
    detectedAt: v.detectedAt ?? null,
    egressed: isEgress(action),
    regulated: dataClass === "phi" || dataClass === "pii" || dataClass === "pci",
  };
}

/**
 * "Egressed" = the data was NOT provably contained. Only a real BLOCK
 * (blocked/prevented/quarantined) stops the data; every other outcome lets it
 * leave: audit/warn/monitor/notify modes ALLOW-and-log (the file still egresses),
 * allowed/overridden explicitly permit it, and an unknown/unmapped action can't be
 * trusted to have contained it. All fail-safe to egress — we never assume an
 * allow-and-log or unclassifiable DLP outcome kept the data in.
 */
function isEgress(action: DlpAction): boolean {
  return action !== "blocked";
}

function normalizeChannel(channel: string | undefined): DlpChannel {
  switch ((channel ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "usb":
    case "removable":
    case "removable_media":
      return "usb";
    case "cloud":
    case "cloud_upload":
    case "cloud_sync":
    case "casb":
      return "cloud";
    case "email":
    case "smtp":
    case "exchange":
      return "email";
    case "web":
    case "http":
    case "upload":
    case "webpost":
      return "web";
    case "print":
    case "printer":
      return "print";
    case "clipboard":
    case "copy_paste":
      return "clipboard";
    case "network_share":
    case "smb":
    case "fileshare":
      return "network_share";
    default:
      return "unknown";
  }
}

function normalizeAction(action: string | undefined): DlpAction {
  switch ((action ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "blocked":
    case "block":
    case "prevented":
    case "quarantined":
      return "blocked";
    case "audited":
    case "audit":
    case "monitored":
    case "notified":
    case "warned":
      return "audited";
    case "allowed":
    case "allow":
    case "permitted":
      return "allowed";
    case "overridden":
    case "override":
    case "user_override":
    case "bypassed":
      return "overridden";
    default:
      return "unknown";
  }
}

function normalizeDataClass(dataClass: string | undefined): DataClass {
  switch ((dataClass ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "phi":
    case "ephi":
    case "health":
      return "phi";
    case "pii":
    case "personal":
      return "pii";
    case "pci":
    case "cardholder":
    case "card_data":
      return "pci";
    case "confidential":
    case "restricted":
    case "secret":
      return "confidential";
    case "internal":
      return "internal";
    case "public":
    case "unclassified":
      return "unclassified";
    default:
      return "unknown";
  }
}
