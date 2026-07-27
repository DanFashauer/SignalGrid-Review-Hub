import { TaskExceptionConnectorError, type TaskExceptionReportRaw } from "./types";
import type { TaskExceptionRequest, TaskExceptionTransport } from "./task-exception-connector";

export interface MockTaskExceptionOptions {
  /** deviceId → raw task-exception report. */
  reports: Record<string, TaskExceptionReportRaw>;
  /** The token the mock bridge accepts; a mismatch surfaces auth_failed (401). */
  expectedToken: string;
}

/** Build an offline transport over a fixed set of reports — no network. Mirrors a real
 *  bridge's failure surface: a bad token → auth_failed(401); an unknown device →
 *  upstream_error(404) (never an invented exception-free task stream). */
export function createMockTaskExceptionTransport(
  options: MockTaskExceptionOptions,
): TaskExceptionTransport {
  return async ({ deviceId, token }: TaskExceptionRequest): Promise<TaskExceptionReportRaw> => {
    if (token !== options.expectedToken) {
      throw new TaskExceptionConnectorError("auth_failed", "invalid bridge token", 401);
    }
    const report = options.reports[deviceId];
    if (!report) {
      throw new TaskExceptionConnectorError("upstream_error", `no task record for device ${deviceId}`, 404);
    }
    return report;
  };
}
