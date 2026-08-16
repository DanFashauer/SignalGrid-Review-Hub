import type { MemoryStore } from "./store";
import { CoreError, type Permission, type Principal, type Role } from "./types";

/**
 * Role → permission matrix (RBAC). Deny-by-default: a permission not listed for
 * a role is denied. Public-safe: authentication here resolves synthetic fixture
 * tokens only — there are no real secrets, sessions, or identity-provider calls.
 * The private production core would replace token lookup with a real
 * authentication provider while keeping this authorization matrix shape.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    "decision:evaluate",
    "decision:read",
    "policy:read",
    "policy:write",
    "connector:read",
    "connector:sync",
    "audit:read",
    "remediation:approve",
    "session:read",
    "session:write",
    "tenant:admin",
  ],
  admin: [
    "decision:evaluate",
    "decision:read",
    "policy:read",
    "policy:write",
    "connector:read",
    "connector:sync",
    "audit:read",
    "remediation:approve",
    "session:read",
    "session:write",
  ],
  // session:* on operator is load-bearing: the operator key is what a host app
  // presents, and the session lifecycle (start/refresh/end) IS the host-app
  // flow. auditor reads sessions but can never move one — read-only means
  // read-only. connector gets neither; a connector has no business in sessions.
  operator: ["decision:evaluate", "decision:read", "policy:read", "connector:read", "session:read", "session:write"],
  auditor: ["decision:read", "policy:read", "connector:read", "audit:read", "session:read"],
  connector: ["connector:read", "connector:sync"],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Resolve a bearer token to a principal. Throws `unauthorized` for an unknown
 * token — fail-closed, never resolve to a default tenant or role.
 */
export function authenticate(store: MemoryStore, token: string): Principal {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new CoreError("unauthorized", "Missing bearer token.", 401);
  }
  const record = store.findApiKeyByToken(trimmed);
  if (!record) {
    throw new CoreError("unauthorized", "Unknown or revoked API key.", 401);
  }
  return {
    tenantId: record.tenantId,
    principalType: record.principalType,
    subjectId: record.subjectId,
    role: record.role,
    keyReference: record.keyReference,
  };
}

/** Enforce a required permission. Throws `forbidden` when the role lacks it. */
export function authorize(principal: Principal, permission: Permission): void {
  if (!roleHasPermission(principal.role, permission)) {
    throw new CoreError(
      "forbidden",
      `Role "${principal.role}" is not permitted to ${permission}.`,
      403,
    );
  }
}

/**
 * Guard against cross-tenant access. A principal may only ever act inside its
 * own tenant; any attempt to target another tenant is denied, not silently
 * ignored.
 */
export function assertSameTenant(principal: Principal, tenantId: string): void {
  if (principal.tenantId !== tenantId) {
    throw new CoreError(
      "cross_tenant_denied",
      "Principal may not access resources outside its tenant.",
      403,
    );
  }
}
