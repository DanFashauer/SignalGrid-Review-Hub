// Read-only normalization + transport for the token-binding connector.
//
// The source is a token-inspection bridge that has already evaluated the session's
// access token for the device — its binding mechanism (DPoP / mTLS / bearer), where
// the proof-of-possession key lives, whether that key is attested hardware, whether
// the token is audience-restricted, and whether the key/cert is bound to THIS device.
// This connector normalizes that already-evaluated result. Every operation here is a
// read; there is no write path (it never mints, refreshes, binds, or revokes a token).

import {
  TokenBindingConnectorError,
  type TokenBindingReportRaw,
  type KeyProtection,
  type TokenBinding,
  type NormalizedTokenBinding,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new TokenBindingConnectorError("read_only_violation", `token binding is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Only an explicit boolean is trusted; anything else is null (not reported). */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Normalize a token-inspection report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown/null, never a fabricated "dpop"/"hardware". */
export function normalizeReport(
  deviceId: string,
  report: TokenBindingReportRaw,
  source = "token-binding-bridge",
): NormalizedTokenBinding {
  const binding = oneOf<TokenBinding>(report.binding, ["dpop", "mtls", "bearer", "unknown"], "unknown");
  let keyProtection = oneOf<KeyProtection>(report.keyProtection, ["hardware", "software", "none", "unknown"], "unknown");
  // Self-consistency: a bearer token has no proof-of-possession key, so a bearer
  // binding forces keyProtection to `none` (fail closed) — a report claiming a
  // `bearer` token WITH a `hardware` key is contradictory and must never read as a
  // protected key. This only ever makes the verdict more conservative.
  if (binding === "bearer") keyProtection = "none";
  return {
    sourceSystem: "token-binding",
    deviceId,
    binding,
    keyProtection,
    keyAttested: boolOrNull(report.keyAttested),
    audienceRestricted: boolOrNull(report.audienceRestricted),
    boundToDevice: boolOrNull(report.boundToDevice),
    bridgeReachable: boolOrNull(report.bridgeReachable),
    source,
  };
}

export interface TokenBindingRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's evaluated token binding from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type TokenBindingTransport = (req: TokenBindingRequest) => Promise<TokenBindingReportRaw>;

export interface TokenBindingConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class TokenBindingConnector {
  constructor(
    private readonly config: TokenBindingConnectorConfig,
    private readonly transport: TokenBindingTransport,
  ) {}

  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof TokenBindingConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchTokenBinding(deviceId: string): Promise<NormalizedTokenBinding> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
