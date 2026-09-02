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
  type AccessLifecycleStage,
  type AccessCertificationState,
  type AccessEntitlementScope,
  type AccessGovernanceReportRaw,
  type AccessPrivilegeState,
  type NormalizedAccessGovernancePosture,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new AccessGovernanceConnectorError("read_only_violation", `access-governance is read-only; refused ${method}`),
);

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** A strict ISO-8601 UTC (Zulu) instant, or null. Anything unreadable is null —
 *  a garbled timestamp is unknown, never an invented recency. */
function instantStringOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  return Number.isFinite(Date.parse(s)) ? s : null;
}

/** Normalize an IGA/PAM-bridge report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown/null, never a fabricated "authorized". */
export function normalizeReport(
  principalId: string,
  report: AccessGovernanceReportRaw,
  source = "iga-bridge",
): NormalizedAccessGovernancePosture {
  const account = report.account ?? {};
  const lifecycle = report.lifecycle ?? {};
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
    lifecycleStage: oneOf<AccessLifecycleStage>(
      lifecycle.stage,
      ["new_hire", "established", "recent_transfer", "unknown"],
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
    observedAt: instantStringOf(report.observedAt),
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
  async healthCheck(principalId: string): Promise<{ healthy: boolean; status: number | null }> {
    try {
      await this.transport({ principalId, token: this.config.accessToken });
      return { healthy: true, status: null };
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
