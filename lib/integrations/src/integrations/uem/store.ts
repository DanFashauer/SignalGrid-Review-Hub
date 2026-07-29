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
 *    answer every time it ran. Freshness now belongs to the caller that owns the
 *    clock — see `lastCheckInAgeSeconds` in `./types`.
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

export const UEMProviderSchema = z.enum(["intune", "jamf", "workspace_one"]);
export type UEMProvider = z.infer<typeof UEMProviderSchema>;

export const UEMConfigSchema = z.object({
  provider: UEMProviderSchema,
  enabled: z.boolean().default(true),
});
export type UEMConfig = z.infer<typeof UEMConfigSchema>;

const UEM_KEY = "uem:config";

/** Process-local fallback when no Redis is configured. */
let inMemoryConfig: UEMConfig | null = null;

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
  onFault: (message: string) => void = (m) => console.warn(`[uem-store] ${m}`),
): Promise<UEMConfig | null> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(UEM_KEY);
      if (data) return UEMConfigSchema.parse(JSON.parse(data));
    } catch (err) {
      onFault(`read failed, using in-memory config: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await redis.quit().catch(() => undefined);
    }
  }
  return inMemoryConfig;
}

export async function setUEMConfig(
  config: UEMConfig,
  onFault: (message: string) => void = (m) => console.warn(`[uem-store] ${m}`),
): Promise<void> {
  const parsed = UEMConfigSchema.parse(config);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.connect();
      await redis.set(UEM_KEY, JSON.stringify(parsed), "EX", 86400);
    } catch (err) {
      onFault(`write failed, kept in memory only: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await redis.quit().catch(() => undefined);
    }
  }
  inMemoryConfig = { ...parsed };
}

/** Test seam — resets the process-local fallback. */
export function __resetUemConfigForTests(): void {
  inMemoryConfig = null;
}
