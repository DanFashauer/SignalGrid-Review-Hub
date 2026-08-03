/**
 * NAC configuration store — which NAC a deployment has selected.
 *
 * WHAT THIS NO LONGER DOES:
 *
 *  - `applyQuarantine()` / `clearQuarantine()` — called `adapter.quarantineEndpoint()`,
 *    which POSTed to the Cisco ISE ANC API or ClearPass to cut an endpoint off the
 *    network. No tier gate, no `SIGNALGRID_LIVE_INTEGRATIONS` check, no approval.
 *    They DID append an audit record, which is more than the `uem/` actuators managed
 *    — but auditing an ungated action makes it traceable, not permitted.
 *
 *  - `getNACAdapter()` read `CISCO_ISE_PASSWORD` / `CLEARPASS_CLIENT_SECRET` from the
 *    environment and constructed a live vendor client in any tier. The gate now lives
 *    in `resolveNacConnector`.
 *
 *  - `lookupEndpoint()` swallowed every error into `null`, so a NAC outage and a
 *    genuinely-unknown endpoint were indistinguishable to `deviceResolver` — which
 *    then treated both as "no identity from NAC" and moved on.
 *
 * What remains is configuration storage. The endpoint read lives in `./index`.
 *
 * NETWORK POSTURE AS A DECISION INPUT IS NOT HERE, deliberately. That is
 * `../network-nac`, which already owns a richer proven model (`NetworkAuthState`
 * including `quarantined`, `NetworkVerdict`, reason codes, and a
 * `read_only_violation` error code). This family exists only to resolve an endpoint
 * identity for `deviceResolver`; two sources of truth for one question would be a
 * regression, not extra coverage.
 */

import { z } from "zod";

import { scopedConfigKey } from "../store-scope";

export const NACProviderSchema = z.enum(["ise", "clearpass"]);
export type NACProvider = z.infer<typeof NACProviderSchema>;

/** STRICT for the same reason as `UEMConfigSchema` — see the note there. `enabled`
 *  defaults to true, so a misspelled key was dropped and the connector came back ON
 *  while the operator believed they had switched it off. Write and read both go through
 *  this schema, so tightening it cannot reject a record this code wrote. */
export const NACConfigSchema = z
  .object({
    provider: NACProviderSchema,
    enabled: z.boolean().default(true),
  })
  .strict();
export type NACConfig = z.infer<typeof NACConfigSchema>;

/** Key PREFIX, not a key. The tenant id is appended by `scopedConfigKey`; this was a
 *  flat `"nac:config"` shared by every tenant until the scoping was added. */
const NAC_KEY_PREFIX = "nac:config";

/** Process-local fallback when no Redis is configured — SCOPED BY TENANT, because a
 *  scoped Redis key with an unscoped process-local singleton behind it leaks in exactly
 *  the deployments the scoping was added for: the fallback is what runs when REDIS_URL
 *  is unset, which is every fixture build and every single-node dev run. */
const inMemoryConfig = new Map<string, NACConfig>();

async function getRedisClient() {
  const url = process.env["REDIS_URL"];
  if (!url) return null;
  const { Redis } = await import("ioredis");
  return new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
}

/** Read the stored config. A Redis fault is reported rather than silently absorbed —
 *  falling back to the process-local value is right for configuration, but it should
 *  be audible. */
export async function getNACConfig(
  tenantId: string,
  onFault: (message: string) => void = (m) => console.warn(`[nac-store] ${m}`),
): Promise<NACConfig | null> {
  // Validate BEFORE touching Redis, so a malformed id can never reach a key builder
  // on some later code path and so the refusal does not depend on network state.
  const key = scopedConfigKey(NAC_KEY_PREFIX, tenantId);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) return NACConfigSchema.parse(JSON.parse(data));
    } catch (err) {
      onFault(`read failed, using in-memory config: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await redis.quit().catch(() => undefined);
    }
  }
  return inMemoryConfig.get(key) ?? null;
}

export async function setNACConfig(
  tenantId: string,
  config: NACConfig,
  onFault: (message: string) => void = (m) => console.warn(`[nac-store] ${m}`),
): Promise<void> {
  const key = scopedConfigKey(NAC_KEY_PREFIX, tenantId);
  const parsed = NACConfigSchema.parse(config);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.connect();
      await redis.set(key, JSON.stringify(parsed), "EX", 86400);
    } catch (err) {
      onFault(`write failed, kept in memory only: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await redis.quit().catch(() => undefined);
    }
  }
  inMemoryConfig.set(key, { ...parsed });
}

/** Test seam — clears the process-local fallback for EVERY tenant. Deliberately not
 *  per-tenant: a reset that left other tenants' entries behind would let one proof's
 *  writes survive into the next and be read as that test's own. */
export function __resetNacConfigForTests(): void {
  inMemoryConfig.clear();
}
