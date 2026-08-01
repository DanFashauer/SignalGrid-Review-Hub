// Read-only normalization + transport for the SSO session-binding connector.
//
// The source is an IdP session-state bridge that has already evaluated the live
// SSO session for the device (Microsoft Entra, Okta, Ping, Duo, etc.) and compared
// its subject to the checked-out badge-holder. This connector normalizes that
// already-evaluated result. Every operation here is a read; there is no write path
// (it never mints, refreshes, or revokes a token — that stays with the IdP).

import {
  SsoSessionConnectorError,
  type AccountScope,
  type SsoSessionReportRaw,
  type SessionAssurance,
  type SessionBinding,
  type SessionFreshness,
  type SsoSessionState,
  type NormalizedSsoSession,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new SsoSessionConnectorError("read_only_violation", `sso session is read-only; refused ${method}`);
  }
}

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

/** Normalize a session-bridge report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown, never a fabricated "bound"/"active". */
export function normalizeReport(
  deviceId: string,
  report: SsoSessionReportRaw,
  source = "sso-session-bridge",
): NormalizedSsoSession {
  const subject = readableString(report.subject);
  const expectedSubject = readableString(report.expectedSubject);
  const accountScope = oneOf<AccountScope>(report.accountScope, ["individual", "shared", "unknown"], "unknown");
  const credentialHolder = readableString(report.credentialHolder);
  let binding = oneOf<SessionBinding>(report.binding, ["bound", "mismatched", "unbound", "unknown"], "unknown");
  // The comparison that corroborates the binding depends on WHOSE name the subject
  // carries. On an individual account the subject IS the person, so the subject
  // comparison is ground truth. On a SHARED account the subject is the ACCOUNT by
  // design — the subject comparison proves nothing either way, and attribution
  // moves to the CREDENTIAL level (which registered authenticator opened it,
  // DigitalPersona v4.4.0-class). Every rule below only ever makes the verdict
  // more conservative; nothing here fabricates `bound`.
  //
  //  - the credential-holder comparison, when both sides are readable, applies on
  //    EVERY scope and only downgrades: a session opened with someone else's
  //    credential is `mismatched` no matter what the subject says;
  //  - individual/unknown scope: subjects readable and DIFFER → `mismatched` (a
  //    mislabeled leftover); a `bound` label without both subjects readable and
  //    equal is uncorroborated → `unknown` (an unknown scope is deliberately
  //    treated as individual — fail-safe: the subject rule stays authoritative);
  //  - shared scope: subjects differing is EXPECTED and forces nothing; a `bound`
  //    label is corroborated ONLY by a credential holder that matches the
  //    checked-out badge-holder — without that, `bound` downgrades to `unknown`
  //    ("the account authenticated" is not "this person is identified").
  if (credentialHolder !== null && expectedSubject !== null && credentialHolder !== expectedSubject) {
    binding = "mismatched";
  }
  if (accountScope === "shared") {
    if (binding === "bound" && !(credentialHolder !== null && expectedSubject !== null && credentialHolder === expectedSubject)) {
      binding = "unknown";
    }
  } else if (subject !== null && expectedSubject !== null) {
    if (subject !== expectedSubject) binding = "mismatched";
  } else if (binding === "bound") {
    binding = "unknown";
  }
  return {
    sourceSystem: "sso-session",
    deviceId,
    state: oneOf<SsoSessionState>(report.state, ["active", "expired", "none", "unknown"], "unknown"),
    binding,
    assurance: oneOf<SessionAssurance>(report.assurance, ["phishing_resistant", "mfa", "single_factor", "unknown"], "unknown"),
    freshness: oneOf<SessionFreshness>(report.freshness, ["fresh", "near_expiry", "expired", "unknown"], "unknown"),
    // Only an explicit boolean is trusted; anything else is null (not reported).
    idpReachable: typeof report.idpReachable === "boolean" ? report.idpReachable : null,
    subject,
    expectedSubject,
    accountScope,
    credentialHolder,
    source,
  };
}

export interface SsoSessionRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's evaluated SSO session from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type SsoSessionTransport = (req: SsoSessionRequest) => Promise<SsoSessionReportRaw>;

export interface SsoSessionConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class SsoSessionConnector {
  constructor(
    private readonly config: SsoSessionConnectorConfig,
    private readonly transport: SsoSessionTransport,
  ) {}

  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof SsoSessionConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchSession(deviceId: string): Promise<NormalizedSsoSession> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
