/**
 * UEM configuration store — which vendor a deployment has selected.
 *
 * WHAT THIS NO LONGER DOES, and why each removal was necessary:
 *
 *  - `getUEMAdapter()` read `INTUNE_CLIENT_SECRET` / `JAMF_PASSWORD` /
 *    `WORKSPACE_ONE_CLIENT_SECRET` straight from the environment and constructed a
 *    LIVE vendor client — in any tier, with no `SIGNALGRID_LIVE_INTEGRATIONS`
 *    check, and with write-capable methods on the object it returned. The gate now
 *    lives in `resolveUemConnector` and the write methods no longer exist.
 *
 *  - `getDevicePosture()` computed `Date.now() - new Date(state.lastSync)`. A
 *    wall-clock read inside a decision path violates golden rule 2 and made this
 *    dimension impossible to replay: the same recorded inputs produced a different
 *    answer every time it ran. This family now grades no freshness at all — the
 *    caller-posed age field that replaced the clock read was never consumed and was
 *    removed 2026-09-01; see the note in `./types`.
 *
 *  - It also asserted `attest: { method: "mdm", confidence: enrolled ? "high" : "low" }`,
 *    claiming an attestation method and a confidence level from a single boolean.
 *    Hardware-rooted attestation is a real dimension in this fabric
 *    (`device-attestation`) with real evidence behind it; manufacturing a "high
 *    confidence" attestation claim from an enrollment flag devalued it.
 *
 *  - Errors were swallowed into `null` (`catch { return null }`), so a vendor
 *    outage and a genuinely-absent device were indistinguishable to every caller.
 *
 * What remains is configuration storage: which vendor, and is the integration
 * enabled. Reading device state goes through `resolveUemConnector` +
 * `normalizeUemDevice` + `evaluateUem`.
 */

import { z } from "zod";

import { scopedConfigKey } from "../store-scope";

export const UEMProviderSchema = z.enum(["intune", "jamf", "workspace_one"]);
export type UEMProvider = z.infer<typeof UEMProviderSchema>;

/**
 * STRICT, and the strictness is the point rather than tidiness.
 *
 * `enabled` defaults to TRUE, so a key zod does not recognize is dropped and the
 * connector comes back ON. An operator writing `{provider:"intune", enable:false}` —
 * one missing letter, trying to turn this connector OFF — got `enabled: true` and a
 * successful parse, with nothing anywhere reporting that the field had been discarded.
 * That is the same shape as the MCP adapter's dropped bounds: a caller states an
 * intention, the schema silently discards it, and the DEFAULT is the affirmative
 * direction. The asymmetry is what makes it worth fixing — a disabled connector
 * contributes no reading and the fabric raises on the resulting unknown, while an
 * unintentionally-enabled one contributes affirmatives that can support a grant.
 *
 * Safe to tighten on the READ path because the WRITE path is this same schema
 * (`setUEMConfig` parses before storing), so no stored record can carry a key this
 * now rejects. `parse` already threw on malformed data; this widens "malformed" to
 * include "contains a field I do not know about", which for a two-field config is
 * always a typo and never a forward-compatible extension.
 */
export const UEMConfigSchema = z
  .object({
    provider: UEMProviderSchema,
    enabled: z.boolean().default(true),
  })
  .strict();
export type UEMConfig = z.infer<typeof UEMConfigSchema>;

/** Key PREFIX, not a key. See `nac/store.ts` — both stores carried the same flat,
 *  tenant-free key and both are scoped by the same helper. */
const UEM_KEY_PREFIX = "uem:config";

/** Process-local fallback when no Redis is configured — SCOPED BY TENANT. Scoping the
 *  Redis key alone would have fixed nothing for any deployment without REDIS_URL set,
 *  which is the default this package documents at the top of `index.ts`. */
const inMemoryConfig = new Map<string, UEMConfig>();

async function getRedisClient() {
  const url = process.env["REDIS_URL"];
  if (!url) return null;
  const { Redis } = await import("ioredis");
  return new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
}

/**
 * Read the stored config.
 *
 * A Redis fault is reported, not swallowed. The previous version caught every
 * error and fell through to the in-memory value, so a deployment could serve a
 * stale process-local config indefinitely while Redis was down and nothing
 * anywhere said so. Falling back is still the right behaviour — this is
 * configuration, not a decision input — but it is now audible.
 */
export async function getUEMConfig(
  tenantId: string,
  onFault: (message: string) => void = (m) => console.warn(`[uem-store] ${m}`),
): Promise<UEMConfig | null> {
  // Validate BEFORE touching Redis — see `nac/store.ts`.
  const key = scopedConfigKey(UEM_KEY_PREFIX, tenantId);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) return UEMConfigSchema.parse(JSON.parse(data));
    } catch (err) {
      onFault(`read failed, using in-memory config: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await redis.quit().catch(() => undefined);
    }
  }
  return inMemoryConfig.get(key) ?? null;
}

export async function setUEMConfig(
  tenantId: string,
  config: UEMConfig,
  onFault: (message: string) => void = (m) => console.warn(`[uem-store] ${m}`),
): Promise<void> {
  const key = scopedConfigKey(UEM_KEY_PREFIX, tenantId);
  const parsed = UEMConfigSchema.parse(config);
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

/** Test seam — clears the process-local fallback for EVERY tenant. See `nac/store.ts`. */
export function __resetUemConfigForTests(): void {
  inMemoryConfig.clear();
}
