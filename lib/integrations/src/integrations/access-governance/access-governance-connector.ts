// Read-only normalization + transport for the IAM / access-governance connector.
//
// The source is an IGA/PAM bridge that has already evaluated the principal's
// governance state (it does NOT re-pull raw directory group membership — graph/uem
// own that). This connector normalizes the bridge's read-only report and, in live
// mode, fetches it. Fixture-safe by default. Every operation is a read — there is
// no write path to any entitlement.

import {
  AccessGovernanceConnectorError,
  type AccessAccountStatus,
  type AccessCertificationState,
  type AccessEntitlementScope,
  type AccessGovernanceReportRaw,
  type AccessPrivilegeState,
  type NormalizedAccessGovernancePosture,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new AccessGovernanceConnectorError("read_only_violation", `access-governance is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Normalize an IGA/PAM-bridge report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown/null, never a fabricated "authorized". */
export function normalizeReport(
  principalId: string,
  report: AccessGovernanceReportRaw,
  source = "iga-bridge",
): NormalizedAccessGovernancePosture {
  const account = report.account ?? {};
  const entitlement = report.entitlement ?? {};
  const certification = report.certification ?? {};
  const sod = report.sod ?? {};
  const privilege = report.privilege ?? {};
  return {
    sourceSystem: "access-governance",
    principalId,
    accountStatus: oneOf<AccessAccountStatus>(
      account.status,
      ["active", "disabled", "orphaned", "leaver_pending", "unknown"],
      "unknown",
    ),
    entitlementScope: oneOf<AccessEntitlementScope>(
      entitlement.scope,
      ["in_scope", "over_privileged", "out_of_scope", "unknown"],
      "unknown",
    ),
    certification: oneOf<AccessCertificationState>(
      certification.state,
      ["certified", "recert_due", "decertified", "never_certified", "unknown"],
      "unknown",
    ),
    sodConflict: typeof sod.conflict === "boolean" ? sod.conflict : null,
    privilege: oneOf<AccessPrivilegeState>(
      privilege.mode,
      ["none", "jit_active", "jit_expired", "standing", "unknown"],
      "unknown",
    ),
    privilegedSessionMonitored: typeof privilege.sessionMonitored === "boolean" ? privilege.sessionMonitored : null,
    source,
  };
}

export interface AccessGovernanceReportRequest {
  principalId: string;
  token: string;
}

/** Fetch one principal's raw governance report from a bridge. Injectable so
 *  tests/fixtures never touch the network. The token travels with the request
 *  (real auth failures). */
export type AccessGovernanceReportTransport = (
  req: AccessGovernanceReportRequest,
) => Promise<AccessGovernanceReportRaw>;

export interface AccessGovernanceConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class AccessGovernanceConnector {
  constructor(
    private readonly config: AccessGovernanceConnectorConfig,
    private readonly transport: AccessGovernanceReportTransport,
  ) {}

  async healthCheck(principalId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ principalId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof AccessGovernanceConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchPosture(principalId: string): Promise<NormalizedAccessGovernancePosture> {
    guardReadOnly("GET");
    const raw = await this.transport({ principalId, token: this.config.accessToken });
    return normalizeReport(principalId, raw, this.config.source);
  }
}
