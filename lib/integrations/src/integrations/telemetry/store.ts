// FleetDM Telemetry Store
// Configuration storage for FleetDM integration (Redis with in-memory fallback)

import { TelemetryConfig, FleetDMConfig, DEFAULT_TELEMETRY_CONFIG } from './types';

const TELEMETRY_KEY = 'telemetry:config';
const POSTURE_CACHE_PREFIX = 'telemetry:posture:';

// In-memory fallback for development
let inMemoryConfig: TelemetryConfig = { ...DEFAULT_TELEMETRY_CONFIG };
const inMemoryPosture: Map<string, { data: unknown; expiresAt: number }> = new Map();

function getRedisUrl(): string | undefined {
  return process.env.REDIS_URL;
}

async function getRedisClient() {
  const { Redis } = await import('ioredis');
  const url = getRedisUrl();
  if (!url) return null;
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
}

export async function getTelemetryConfig(): Promise<TelemetryConfig> {
  const redis = await getRedisClient();
  
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(TELEMETRY_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }
  
  return inMemoryConfig;
}

export async function setTelemetryConfig(config: TelemetryConfig): Promise<void> {
  const redis = await getRedisClient();
  
  if (redis) {
    try {
      await redis.connect();
      await redis.set(TELEMETRY_KEY, JSON.stringify(config), 'EX', 86400);
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }
  
  inMemoryConfig = { ...config };
}

export async function getFleetDMConfig(): Promise<FleetDMConfig | null> {
  const config = await getTelemetryConfig();
  
  // Check environment variables first for API token (never stored in Redis)
  const envBaseUrl = process.env.FLEETDM_BASE_URL;
  const envApiToken = process.env.FLEETDM_API_TOKEN;
  
  if (!config.fleetdm?.enabled && !envBaseUrl) {
    return null;
  }
  
  return {
    enabled: config.fleetdm?.enabled ?? false,
    baseUrl: envBaseUrl ?? config.fleetdm?.baseUrl ?? '',
    apiToken: envApiToken ?? config.fleetdm?.apiToken ?? '',
    teamId: config.fleetdm?.teamId,
    syncIntervalMs: config.fleetdm?.syncIntervalMs ?? 300000, // 5 min default
  };
}

export async function setFleetDMConfig(config: FleetDMConfig): Promise<void> {
  const currentConfig = await getTelemetryConfig();
  await setTelemetryConfig({
    ...currentConfig,
    mode: config.enabled ? 'optional' : 'off',
    fleetdm: {
      ...config,
      // Never store API token in Redis - only in env
      apiToken: '',
    },
  });
}

export interface CachedPosture {
  data: unknown;
  expiresAt: number;
}

/**
 * Is a cached entry unusable? Anything we cannot positively establish as still
 * live counts as expired — a missing, non-numeric or NaN `expiresAt` included.
 *
 * The NaN arm is not hypothetical here. `NaN <= now` evaluates FALSE, so a plain
 * `entry.expiresAt <= now` check would report a NaN expiry as STILL VALID and serve
 * the entry forever. That is the same fail-open family already fixed on auth expiry
 * in this repository; it is closed here by requiring Number.isFinite rather than by
 * comparing and hoping.
 */
export function isPostureExpired(entry: CachedPosture, now: number): boolean {
  // freshness: local-by-design — not the sighting-freshness rule — an EXPIRY/TTL comparison, where an unreadable bound must read EXPIRED. CORRECTED 2026-09-02: this marker used to name check-nan-fail-open.mjs as its gate, which has nothing to key on here — `expiresAt` is a stored number and never passes through Date.parse or .getTime(). The guard is the `!Number.isFinite(entry.expiresAt)` disjunct ON THIS LINE, which reads an unusable bound as EXPIRED, plus `parsePostureEntry` at store.ts:128, which refuses to build a CachedPosture from a non-finite expiresAt at all.
  return !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now;
}

/** Parse a stored entry, returning null for anything malformed. Fail closed: an
 *  unreadable cache entry is treated as no cache entry, which forces a fresh fetch. */
export function parsePostureEntry(raw: string): CachedPosture | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { data: (parsed as { data?: unknown }).data, expiresAt };
}

/**
 * Read a host's cached posture, or null when there is none that is still live.
 *
 * WAS: `return inMemoryPosture.get(key) ?? null`, and `JSON.parse(data)` on the Redis
 * side — neither consulted `expiresAt`. Redis expires its own keys via `EX`, so that
 * half was covered by the server; the IN-MEMORY half, which is the default path
 * whenever REDIS_URL is unset AND the fallback whenever Redis throws, returned
 * indefinitely stale posture with an `expiresAt` long in the past. The field was
 * computed on write, stored, and read by nothing in the repository.
 *
 * Stale posture must TIGHTEN the answer, never be served as current: an expired or
 * unreadable entry now returns null, which reads as "no cached posture" and forces a
 * fresh fetch rather than handing back a stale device state.
 *
 * `now` is injectable so the proof can drive expiry deterministically rather than
 * sleeping.
 */
export async function getPostureForHost(
  hostUuid: string,
  now: number = Date.now(),
): Promise<CachedPosture | null> {
  const redis = await getRedisClient();
  const key = `${POSTURE_CACHE_PREFIX}${hostUuid}`;
  
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) {
        const entry = parsePostureEntry(data);
        return entry !== null && !isPostureExpired(entry, now) ? entry : null;
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }
  
  const cached = inMemoryPosture.get(key);
  if (cached === undefined) return null;
  if (isPostureExpired(cached, now)) {
    inMemoryPosture.delete(key);
    return null;
  }
  return cached;
}

/**
 * Drop every in-memory entry that is past its expiry.
 *
 * Redis prunes itself through `EX`; the Map did not prune at all. It gained one entry
 * per host UUID on every posture fetch and was emptied only by an explicit
 * clearPostureCache(), so a long-running process polling a fleet grew it without
 * bound. Called on write, which is the path that actually runs today.
 *
 * `now` is REQUIRED rather than defaulted: this package declares its clock reads in
 * scripts/review-invariants.mjs and every default `= Date.now()` is another one. The
 * write path already samples the clock for `expiresAt`; the sweep reuses that sample.
 */
export function purgeExpiredPosture(now: number): number {
  let removed = 0;
  for (const [key, entry] of inMemoryPosture) {
    if (isPostureExpired(entry, now)) {
      inMemoryPosture.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** In-memory entry count. Exposed so the proof can assert the Map is bounded. */
export function inMemoryPostureSize(): number {
  return inMemoryPosture.size;
}

export async function setPostureForHost(
  hostUuid: string,
  data: unknown,
  ttlSeconds: number = 300
): Promise<void> {
  const redis = await getRedisClient();
  const key = `${POSTURE_CACHE_PREFIX}${hostUuid}`;
  const nowMs = Date.now();
  const expiresAt = nowMs + ttlSeconds * 1000;
  const value = JSON.stringify({ data, expiresAt });
  
  if (redis) {
    try {
      await redis.connect();
      await redis.set(key, value, 'EX', ttlSeconds);
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }
  
  inMemoryPosture.set(key, { data, expiresAt });
  purgeExpiredPosture(nowMs);
}

export async function clearPostureCache(): Promise<void> {
  const redis = await getRedisClient();
  
  if (redis) {
    try {
      await redis.connect();
      const keys = await redis.keys(`${POSTURE_CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }
  
  inMemoryPosture.clear();
}
