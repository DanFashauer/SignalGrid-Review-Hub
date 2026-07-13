import { SignalGridCore } from "@workspace/signalgrid-core";

/**
 * Shared, process-wide product core, preloaded with the deterministic
 * public-safe demo seed. This backs the /v1 product surface WITHOUT a database:
 * the core is an in-memory, fixture-backed store, so the tenant/auth/policy/
 * decision/evidence/audit endpoints work out of the box for review. It carries
 * no real credentials, tenant data, or live vendor calls.
 */
export const core: SignalGridCore = SignalGridCore.demo();

/**
 * The public-safe demo API keys, surfaced so the operator console and reviewers
 * can authenticate against the seeded tenants. These are obviously-fake tokens,
 * never real secrets.
 */
export const DEMO_KEYS = core.demoApiKeys().map((key) => ({
  tenant: key.tenantId,
  role: key.role,
  token: key.token,
  keyReference: key.keyReference,
}));
