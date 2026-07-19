import type { Role } from "@workspace/signalgrid-core";
import type { ClaimMapping } from "./claims";

/**
 * Enterprise (OIDC) auth is GATED OFF by default. It turns on only when the
 * operator supplies an issuer + audience via environment, exactly like the
 * durable-persistence layer is gated on DATABASE_URL. With it unset, the API
 * keeps using the public-safe demo bearer keys and nothing here runs — so the
 * fixture build and CI are unaffected.
 *
 * Wiring it to a real IdP is a one-time configuration step (no code change):
 *   OIDC_ISSUER            e.g. https://login.microsoftonline.com/<tenant>/v2.0
 *   OIDC_AUDIENCE          the API's app-id / client-id
 *   OIDC_JWKS_URI          the IdP's JWKS endpoint (discovery jwks_uri)
 *   OIDC_TENANT_CLAIM      claim holding the IdP tenant   (default "tid")
 *   OIDC_ROLE_CLAIM        claim holding the role/group   (default "roles")
 *   OIDC_TENANT_MAP        JSON: { "<idp-tenant>": "<internal-tenantId>" }
 *   OIDC_ROLE_MAP          JSON: { "<idp-role>": "owner|admin|operator|auditor|connector" }
 */

export interface EnterpriseAuthConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  mapping: ClaimMapping;
  clockToleranceSec: number;
}

const VALID_ROLES: readonly Role[] = ["owner", "admin", "operator", "auditor", "connector"];

export type ConfigResult =
  | { status: "disabled" }
  | { status: "enabled"; config: EnterpriseAuthConfig }
  | { status: "invalid"; reason: string };

export function loadEnterpriseAuthConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const issuer = env.OIDC_ISSUER?.trim();
  if (!issuer) {
    return { status: "disabled" };
  }
  const audience = env.OIDC_AUDIENCE?.trim();
  const jwksUri = env.OIDC_JWKS_URI?.trim();
  if (!audience || !jwksUri) {
    return {
      status: "invalid",
      reason: "OIDC_ISSUER is set but OIDC_AUDIENCE and/or OIDC_JWKS_URI are missing.",
    };
  }

  const tenantMap = parseJsonRecord(env.OIDC_TENANT_MAP);
  if (!tenantMap) {
    return { status: "invalid", reason: "OIDC_TENANT_MAP must be a JSON object of {idpTenant: internalTenantId}." };
  }
  const roleMapRaw = parseJsonRecord(env.OIDC_ROLE_MAP);
  if (!roleMapRaw) {
    return { status: "invalid", reason: "OIDC_ROLE_MAP must be a JSON object of {idpRole: role}." };
  }
  const roleByClaimValue: Record<string, Role> = {};
  for (const [key, value] of Object.entries(roleMapRaw)) {
    if (!VALID_ROLES.includes(value as Role)) {
      return { status: "invalid", reason: `OIDC_ROLE_MAP value "${value}" is not a valid role.` };
    }
    roleByClaimValue[key] = value as Role;
  }

  const toleranceRaw = Number(env.OIDC_CLOCK_TOLERANCE_SEC);
  const clockToleranceSec = Number.isFinite(toleranceRaw) && toleranceRaw >= 0 ? Math.floor(toleranceRaw) : 60;

  return {
    status: "enabled",
    config: {
      issuer,
      audience,
      jwksUri,
      clockToleranceSec,
      mapping: {
        tenantClaim: env.OIDC_TENANT_CLAIM?.trim() || "tid",
        roleClaim: env.OIDC_ROLE_CLAIM?.trim() || "roles",
        subjectClaim: env.OIDC_SUBJECT_CLAIM?.trim() || "sub",
        tenantByClaimValue: tenantMap,
        roleByClaimValue,
        principalType: "user",
      },
    },
  };
}

/** A bearer token is a JWT candidate when it has three non-empty dot segments. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function parseJsonRecord(raw: string | undefined): Record<string, string> | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") {
        return null;
      }
      out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}
