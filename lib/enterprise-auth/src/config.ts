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
 *   OIDC_SUBJECT_CLAIM     claim holding the subject      (default "sub")
 *   OIDC_CLOCK_TOLERANCE_SEC  allowed clock skew in seconds (default 60)
 *
 * "Unset" means EVERY one of these is absent, empty or whitespace-only. A blank
 * OIDC_ISSUER while any other OIDC variable is non-blank is `invalid`, and the
 * api-server refuses to boot on `invalid` (owner decision 2026-11-06).
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

/**
 * Every OIDC variable this loader reads besides OIDC_ISSUER. Setting any of them
 * is an operator reaching for enterprise authentication, so with a blank issuer
 * it is a misconfiguration, never "OIDC off". Keep this list in step with the
 * reads below.
 */
export const OIDC_COMPANION_VARIABLES = [
  "OIDC_AUDIENCE",
  "OIDC_JWKS_URI",
  "OIDC_TENANT_MAP",
  "OIDC_ROLE_MAP",
  "OIDC_TENANT_CLAIM",
  "OIDC_ROLE_CLAIM",
  "OIDC_SUBJECT_CLAIM",
  "OIDC_CLOCK_TOLERANCE_SEC",
] as const;

export function loadEnterpriseAuthConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const issuer = env.OIDC_ISSUER?.trim();
  if (!issuer) {
    // OIDC is OFF only when EVERY OIDC variable is absent or blank — what
    // docker-compose.prod.yml's `${OIDC_*:-}` pass-through injects when the host
    // sets none of them. A blank or whitespace-only issuer beside any non-blank
    // companion is a misconfiguration (owner decision 2026-11-06, "Refuse to
    // start"): answering it with `disabled` put the default review-demo profile
    // back on the published demo bearers while the operator believed OIDC was
    // enforcing — an ambiguous setting loosening the answer, which golden rule 2
    // forbids. The reason names the variables, never their values.
    const set = OIDC_COMPANION_VARIABLES.filter((name) => (env[name]?.trim() ?? "") !== "");
    if (set.length > 0) {
      return {
        status: "invalid",
        reason:
          `OIDC_ISSUER is unset or blank but ${set.join(", ")} ${set.length === 1 ? "is" : "are"} set — ` +
          "set OIDC_ISSUER to enable enterprise OIDC, or clear every OIDC_* variable to leave it off.",
      };
    }
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
  // An EMPTY map is well-formed JSON and a dead deployment: no tenant (or
  // role) can ever match, so every verified token is refused — while a
  // status-only readiness check would still report the gateway ready. Same
  // for a mapping whose target is blank. Both are configuration errors.
  if (Object.keys(tenantMap).length === 0) {
    return { status: "invalid", reason: "OIDC_TENANT_MAP is empty — no tenant can match, every verified token would be refused." };
  }
  if (Object.values(tenantMap).some((v) => v.trim().length === 0)) {
    return { status: "invalid", reason: "OIDC_TENANT_MAP has an empty internal-tenant target." };
  }
  const roleMapRaw = parseJsonRecord(env.OIDC_ROLE_MAP);
  if (!roleMapRaw) {
    return { status: "invalid", reason: "OIDC_ROLE_MAP must be a JSON object of {idpRole: role}." };
  }
  if (Object.keys(roleMapRaw).length === 0) {
    return { status: "invalid", reason: "OIDC_ROLE_MAP is empty — no role can match, every verified token would be refused." };
  }
  const roleByClaimValue: Record<string, Role> = {};
  for (const [key, value] of Object.entries(roleMapRaw)) {
    if (!VALID_ROLES.includes(value as Role)) {
      return { status: "invalid", reason: `OIDC_ROLE_MAP value "${value}" is not a valid role.` };
    }
    roleByClaimValue[key] = value as Role;
  }

  // Blank must mean UNSET, not zero: a compose pass-through with the variable
  // unset on the host injects "" here, and Number("") is 0 — a silent zero
  // tolerance rejects valid tokens for ordinary clock skew.
  const toleranceTrimmed = env.OIDC_CLOCK_TOLERANCE_SEC?.trim();
  const toleranceRaw = toleranceTrimmed ? Number(toleranceTrimmed) : NaN;
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
