/**
 * NAC (Network Access Control) Store
 * 
 * Manages NAC adapter configurations for Cisco ISE and Aruba ClearPass.
 * Provides unified interface for endpoint lookup and quarantine actions.
 */

import { z } from 'zod';
import { CiscoISEAdapter, CiscoISEConfig } from './cisco-ise';
import { ArubaClearPassAdapter, ArubaClearPassConfig } from './aruba-clearpass';
import type { NACAdapter, NACEndpointInfo } from '../adapters/types';
import { appendAuditRecord } from '@workspace/audit';
import { resolveEmission } from '../adapters/emit-gate';

// ============================================================================
// Types
// ============================================================================

export const NACProviderSchema = z.enum(['ise', 'clearpass']);
export type NACProvider = z.infer<typeof NACProviderSchema>;

export const NACConfigSchema = z.object({
  provider: NACProviderSchema,
  enabled: z.boolean().default(true),
});
export type NACConfig = z.infer<typeof NACConfigSchema>;

// ============================================================================
// Store
// ============================================================================

const NAC_KEY = 'nac:config';

let inMemoryConfig: NACConfig | null = null;

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

export async function getNACConfig(): Promise<NACConfig | null> {
  const redis = await getRedisClient();
  
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(NAC_KEY);
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

export async function setNACConfig(config: NACConfig): Promise<void> {
  const redis = await getRedisClient();
  
  if (redis) {
    try {
      await redis.connect();
      await redis.set(NAC_KEY, JSON.stringify(config), 'EX', 86400);
    } catch {
      // Fall through to in-memory
    } finally {
      await redis.quit();
    }
  }
  
  inMemoryConfig = { ...config };
}

// ============================================================================
// Adapter Factory
// ============================================================================

let cachedAdapter: NACAdapter | null = null;

export async function getNACAdapter(): Promise<NACAdapter | null> {
  if (cachedAdapter) {
    return cachedAdapter;
  }
  
  const config = await getNACConfig();
  
  if (!config?.enabled || !config.provider) {
    return null;
  }
  
  const provider = config.provider;
  
  switch (provider) {
    case 'ise': {
      const baseUrl = process.env.CISCO_ISE_BASE_URL;
      const username = process.env.CISCO_ISE_USERNAME;
      const password = process.env.CISCO_ISE_PASSWORD;
      
      if (!baseUrl || !username || !password) {
        console.warn('[NACStore] Cisco ISE credentials not configured');
        return null;
      }
      
      cachedAdapter = new CiscoISEAdapter({
        baseUrl,
        username,
        password,
      });
      break;
    }
    
    case 'clearpass': {
      const baseUrl = process.env.CLEARPASS_BASE_URL;
      const clientId = process.env.CLEARPASS_CLIENT_ID;
      const clientSecret = process.env.CLEARPASS_CLIENT_SECRET;
      
      if (!baseUrl || !clientId || !clientSecret) {
        console.warn('[NACStore] Aruba ClearPass credentials not configured');
        return null;
      }
      
      cachedAdapter = new ArubaClearPassAdapter({
        baseUrl,
        clientId,
        clientSecret,
      });
      break;
    }
    
    default:
      console.warn(`[NACStore] Unknown provider: ${provider}`);
      return null;
  }
  
  return cachedAdapter;
}

export async function clearNACAdapterCache(): Promise<void> {
  cachedAdapter = null;
}

// ============================================================================
// NAC Actions
// ============================================================================

/**
 * Look up an endpoint by identifier
 */
export async function lookupEndpoint(
  identifier: string,
  type: 'mac' | 'serial' | 'cert' = 'mac'
): Promise<NACEndpointInfo | null> {
  // GATED. This function is the package's public NAC surface — `lib/integrations`
  // re-exports this whole module as `nac`, so `nac.lookupEndpoint(...)` was callable
  // from anywhere and reached Cisco ISE / Aruba ClearPass at ANY tier, with no
  // SIGNALGRID_LIVE_INTEGRATIONS check. The quarantine ACTUATORS were correctly deleted
  // in #150 (see the note below); the read path they sat beside was left behind, which
  // is the more common shape — the dangerous-looking code gets removed and the merely
  // live-calling code inherits the clean bill of health.
  //
  // null is already this function's answer for "cannot tell you" (unconfigured, or a
  // failed lookup), and null is the fail-CLOSED value downstream: an absent NAC reading
  // raises assurance rather than granting anything.
  const emission = resolveEmission();
  if (emission.mode !== 'live') {
    return null;
  }

  const adapter = await getNACAdapter();

  if (!adapter) {
    console.warn('[NACStore] NAC not configured');
    return null;
  }

  try {
    return await adapter.lookupEndpoint(identifier, type);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[NACStore] Lookup failed:', message);
    return null;
  }
}

// WHAT WAS REMOVED. `applyQuarantine` and `clearQuarantine` forwarded to the
// vendor adapters' quarantine actuators — a DEVICE ACTION over the network,
// the class deleted from uem/ in #150 and now gone from the adapters and the
// NACAdapter contract too. This store reads NAC state; it does not change it.

/**
 * Health check for NAC
 */
export async function getNACHealthStatus(): Promise<{ provider: string | null; healthy: boolean; message: string }> {
  const config = await getNACConfig();
  
  if (!config?.enabled) {
    return { provider: null, healthy: false, message: 'NAC not enabled' };
  }
  
  // Same gate, same reason: a health check resolves the configured ISE/ClearPass
  // hostname and opens a connection. "not live" is reported as not-healthy with the
  // reason stated, rather than as a failure — the caller learns why, and nothing
  // reads it as a working connection.
  const emission = resolveEmission();
  if (emission.mode !== 'live') {
    return { provider: config.provider, healthy: false, message: `Not checked: ${emission.reason ?? 'live integrations are gated off'}` };
  }

  const adapter = await getNACAdapter();

  if (!adapter) {
    return { provider: config.provider, healthy: false, message: 'Adapter not initialized' };
  }

  try {
    const healthy = await adapter.healthCheck?.() ?? false;
    return { 
      provider: config.provider, 
      healthy, 
      message: healthy ? 'Connected' : 'Connection failed' 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { provider: config.provider, healthy: false, message };
  }
}
