// Read-only normalization + transport for the OAuth-consent connector.
//
// The source is an OAuth/consent-governance bridge that has already evaluated the
// riskiest delegated grant on the principal (Microsoft Entra enterprise apps / OAuth
// grants, Okta OAuth, Google Workspace app access). This connector normalizes that
// already-evaluated result. Every operation here is a read; there is no write path
// (it never revokes a grant or consent — that stays with the IdP).

import {
  OAuthConsentConnectorError,
  type OAuthConsentReportRaw,
  type ConsentType,
  type GrantPresence,
  type GrantScope,
  type PublisherTrust,
  type WorkloadCredential,
  type NormalizedOAuthConsent,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new OAuthConsentConnectorError("read_only_violation", `oauth consent is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Normalize a consent-bridge report. Defensive throughout: a missing/errored field
 *  yields the fail-safe unknown, never a fabricated "none"/"verified"/"admin". */
export function normalizeReport(
  principalId: string,
  report: OAuthConsentReportRaw,
  source = "oauth-consent-bridge",
): NormalizedOAuthConsent {
  return {
    sourceSystem: "oauth-consent",
    principalId,
    grants: oneOf<GrantPresence>(report.grants, ["present", "none", "unknown"], "unknown"),
    consentType: oneOf<ConsentType>(report.consentType, ["admin", "user", "unknown"], "unknown"),
    publisher: oneOf<PublisherTrust>(report.publisher, ["verified", "unverified", "unknown"], "unknown"),
    scope: oneOf<GrantScope>(report.scope, ["least", "broad", "full_access", "unknown"], "unknown"),
    workloadCredential: oneOf<WorkloadCredential>(report.workloadCredential, ["managed", "unmanaged_secret", "none", "unknown"], "unknown"),
    // Only an explicit boolean is trusted; anything else is null (not reported).
    idpReachable: typeof report.idpReachable === "boolean" ? report.idpReachable : null,
    riskyGrantCount: typeof report.riskyGrantCount === "number" && Number.isFinite(report.riskyGrantCount) ? report.riskyGrantCount : null,
    source,
  };
}

export interface OAuthConsentRequest {
  principalId: string;
  token: string;
}

/** Fetch one principal's evaluated consent state from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type OAuthConsentTransport = (req: OAuthConsentRequest) => Promise<OAuthConsentReportRaw>;

export interface OAuthConsentConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class OAuthConsentConnector {
  constructor(
    private readonly config: OAuthConsentConnectorConfig,
    private readonly transport: OAuthConsentTransport,
  ) {}

  async healthCheck(principalId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ principalId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof OAuthConsentConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchConsent(principalId: string): Promise<NormalizedOAuthConsent> {
    guardReadOnly("GET");
    const raw = await this.transport({ principalId, token: this.config.accessToken });
    return normalizeReport(principalId, raw, this.config.source);
  }
}
