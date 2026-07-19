import type { PrincipalType, Role } from "@workspace/signalgrid-core";
import type { JwtClaims } from "./jwt";

/**
 * Maps verified OIDC claims to an INTERNAL principal shape (tenant + role +
 * subject). This is deny-by-default: an incoming tenant or role value that is
 * not explicitly present in the configured allow-maps is REJECTED, never
 * defaulted. That keeps a valid-but-unmapped enterprise identity from silently
 * landing in the wrong tenant or gaining a role it was never granted.
 *
 * The claim NAMES are configurable so this works with Entra ID (`tid` / `roles`),
 * Okta, Auth0, or a custom namespaced claim, without code changes.
 */

export interface ClaimMapping {
  /** Claim carrying the caller's IdP tenant/org (e.g. "tid"). */
  tenantClaim: string;
  /** Claim carrying the caller's role/group (e.g. "roles" or "groups"). */
  roleClaim: string;
  /** Claim carrying the stable subject id. Default "sub". */
  subjectClaim?: string;
  /** IdP tenant value → internal tenant id. Only listed tenants are allowed. */
  tenantByClaimValue: Record<string, string>;
  /** IdP role value → internal Role. Only listed roles are allowed. */
  roleByClaimValue: Record<string, Role>;
  /** Principal type to record. Default "user". */
  principalType?: PrincipalType;
}

export interface PrincipalInput {
  tenantId: string;
  role: Role;
  subjectId: string;
  principalType: PrincipalType;
}

export type MapResult =
  | { ok: true; principal: PrincipalInput }
  | { ok: false; reason: string };

export function mapClaimsToPrincipal(claims: JwtClaims, mapping: ClaimMapping): MapResult {
  const subjectClaim = mapping.subjectClaim ?? "sub";
  const subjectId = asString(claims[subjectClaim]);
  if (!subjectId) {
    return { ok: false, reason: `missing or non-string subject claim "${subjectClaim}"` };
  }

  const tenantValue = asString(claims[mapping.tenantClaim]);
  if (!tenantValue) {
    return { ok: false, reason: `missing or non-string tenant claim "${mapping.tenantClaim}"` };
  }
  const tenantId = Object.prototype.hasOwnProperty.call(mapping.tenantByClaimValue, tenantValue)
    ? mapping.tenantByClaimValue[tenantValue]
    : undefined;
  if (!tenantId) {
    return { ok: false, reason: `tenant claim value "${tenantValue}" is not mapped to a tenant` };
  }

  // The role claim may be a single value or an array (Entra emits `roles` as an
  // array). Accept the FIRST value that maps to a known role; if none map, deny.
  const roleValues = asStringArray(claims[mapping.roleClaim]);
  if (roleValues.length === 0) {
    return { ok: false, reason: `missing role claim "${mapping.roleClaim}"` };
  }
  let role: Role | undefined;
  for (const value of roleValues) {
    if (Object.prototype.hasOwnProperty.call(mapping.roleByClaimValue, value)) {
      role = mapping.roleByClaimValue[value];
      break;
    }
  }
  if (!role) {
    return { ok: false, reason: `no role claim value in [${roleValues.join(", ")}] maps to a known role` };
  }

  return {
    ok: true,
    principal: {
      tenantId,
      role,
      subjectId,
      principalType: mapping.principalType ?? "user",
    },
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return [];
}
