import { DeviceManagementHealthConnectorError, type DeviceManagementHealthReportRaw } from "./types";
import type {
  DeviceManagementHealthRequest,
  DeviceManagementHealthTransport,
} from "./device-management-health-connector";

export interface MockDeviceManagementHealthOptions {
  /** deviceId → raw management-health report. */
  reports: Record<string, DeviceManagementHealthReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a real
 *  bridge's failure surface: a bad token → auth_failed(401); an unknown device →
 *  upstream_error(404) (never an invented healthy device). */
export function createMockDeviceManagementHealthTransport(
  options: MockDeviceManagementHealthOptions,
): DeviceManagementHealthTransport {
  return async ({ deviceId, token }: DeviceManagementHealthRequest): Promise<DeviceManagementHealthReportRaw> => {
    if (token !== options.expectedToken) {
      throw new DeviceManagementHealthConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new DeviceManagementHealthConnectorError(
        "upstream_error",
        `no management record for device ${deviceId}`,
        404,
      );
    }
    return report;
  };
}
