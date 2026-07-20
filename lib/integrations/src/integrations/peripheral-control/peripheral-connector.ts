import {
  PeripheralConnectorError,
  type NormalizedPeripheral,
  type NormalizedPeripheralPosture,
  type PeripheralAccess,
  type PeripheralClass,
  type PeripheralCollection,
  type PeripheralPostureRaw,
  type PeripheralRaw,
} from "./types";

/**
 * Read-only removable-media / peripheral-control connector. Reads per-device
 * attached-peripheral inventory + device-control policy state and normalizes it.
 * READ-ONLY by construction (GET-only, guarded) — it never blocks a device,
 * ejects media, or changes a device-control policy; those stay explicit,
 * separately-authorized actions. Injectable transport for offline proofs.
 */

export interface PeripheralRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface PeripheralHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
export type PeripheralTransport = (req: PeripheralRequest) => Promise<PeripheralHttpResponse>;

export interface PeripheralConnectorConfig {
  accessToken: string;
  baseUrl?: string;
  pageLimit?: number;
}

/** Fail closed on any non-GET method — the connector must never mutate. */
export function guardReadOnly(method: string): void {
  if (method !== "GET") {
    throw new PeripheralConnectorError("read_only_violation", `The peripheral-control connector is read-only; refused a ${method} request.`);
  }
}

export class PeripheralControlConnector {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly pageLimit: number;
  private readonly transport: PeripheralTransport;

  constructor(config: PeripheralConnectorConfig, transport: PeripheralTransport) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? "https://api.devicecontrol.example/v1").replace(/\/$/, "");
    this.pageLimit = Math.max(1, config.pageLimit ?? 50);
    this.transport = transport;
  }

  async healthCheck(): Promise<{ healthy: boolean; status: number }> {
    try {
      const res = await this.rawGet(`${this.baseUrl}/device-peripherals?limit=1`);
      return { healthy: res.ok, status: res.status };
    } catch {
      return { healthy: false, status: 0 };
    }
  }

  async listDevices(): Promise<PeripheralPostureRaw[]> {
    return this.getAllPages<PeripheralPostureRaw>(`${this.baseUrl}/device-peripherals`);
  }

  async fetchDevices(): Promise<NormalizedPeripheralPosture[]> {
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
      let body: PeripheralCollection<T>;
      try {
        body = (await res.json()) as PeripheralCollection<T>;
      } catch {
        throw new PeripheralConnectorError("bad_response", "Peripheral-control response was not valid JSON.", res.status);
      }
      if (!Array.isArray(body.value)) {
        throw new PeripheralConnectorError("bad_response", "Peripheral-control collection had no `value` array.", res.status);
      }
      out.push(...body.value);
      url = body.nextPageToken ? `${firstUrl}?pageToken=${encodeURIComponent(body.nextPageToken)}` : undefined;
      pages += 1;
    }
    return out;
  }

  private async rawGet(url: string): Promise<PeripheralHttpResponse> {
    const req: PeripheralRequest = {
      method: "GET",
      url,
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
    };
    guardReadOnly(req.method);
    return this.transport(req);
  }
}

function errorFor(status: number): PeripheralConnectorError {
  if (status === 401 || status === 403) {
    return new PeripheralConnectorError("auth_failed", `Device-control platform returned ${status}.`, status);
  }
  return new PeripheralConnectorError("upstream_error", `Device-control platform returned HTTP ${status}.`, status);
}

export function normalizeDevice(device: PeripheralPostureRaw): NormalizedPeripheralPosture {
  return {
    sourceSystem: "peripheral-control",
    deviceId: device.deviceId,
    policyEnforced: typeof device.policyEnforced === "boolean" ? device.policyEnforced : null,
    peripherals: (device.peripherals ?? []).map(normalizePeripheral),
    source: device.source ?? "unknown",
  };
}

export function normalizePeripheral(p: PeripheralRaw): NormalizedPeripheral {
  return {
    peripheralId: p.peripheralId ?? null,
    class: normalizeClass(p.class),
    access: normalizeAccess(p.access),
    encrypted: typeof p.encrypted === "boolean" ? p.encrypted : null,
    authorized: typeof p.authorized === "boolean" ? p.authorized : null,
    productName: p.productName ?? null,
  };
}

function normalizeClass(cls: string | undefined): PeripheralClass {
  switch ((cls ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "mass_storage":
    case "usb_storage":
    case "usb_mass_storage":
    case "removable_disk":
    case "removable_storage":
    case "removable_media":
    case "removablemediadevices":
    case "disk":
    case "usb_drive":
    case "flash_drive":
    case "thumb_drive":
    case "external_drive":
    case "external_hdd":
    case "external_ssd":
    case "sd_card":
    case "sdcard":
    case "mmc":
    case "cdrom":
    case "cd_rom":
    case "cdromdevices":
    case "optical":
    case "floppy":
      return "mass_storage";
    case "mtp":
    case "ptp":
    case "portable_device":
    case "phone":
    case "wpd":
    case "wpddevices":
      return "mtp";
    case "imaging":
    case "camera":
    case "scanner":
      return "imaging";
    case "input":
    case "keyboard":
    case "mouse":
    case "hid":
      return "input";
    case "printer":
      return "printer";
    case "network":
    case "wwan":
    case "ethernet":
      return "network";
    case "other":
      return "other";
    default:
      return "unknown";
  }
}

function normalizeAccess(access: string | undefined): PeripheralAccess {
  switch ((access ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "blocked":
    case "denied":
    case "deny":
      return "blocked";
    case "read_only":
    case "readonly":
    case "ro":
      return "read_only";
    case "read_write":
    case "readwrite":
    case "rw":
    case "allowed":
    case "allow":
    case "full":
      return "read_write";
    default:
      // Missing / unrecognized access on a peripheral → unknown, which the
      // evaluator fail-safes to "writable".
      return "unknown";
  }
}
