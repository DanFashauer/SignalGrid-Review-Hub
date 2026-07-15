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

export async function getPostureForHost(hostUuid: string): Promise<{
  data: unknown;
  expiresAt: number;
} | null> {
  const redis = await getRedisClient();
  const key = `${POSTURE_CACHE_PREFIX}${hostUuid}`;
  
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }
  
  return inMemoryPosture.get(key) ?? null;
}

export async function setPostureForHost(
  hostUuid: string,
  data: unknown,
  ttlSeconds: number = 300
): Promise<void> {
  const redis = await getRedisClient();
  const key = `${POSTURE_CACHE_PREFIX}${hostUuid}`;
  const expiresAt = Date.now() + ttlSeconds * 1000;
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
