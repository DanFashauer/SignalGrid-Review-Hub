/**
 * NAC (Network Access Control) Store
 * 
 * Manages NAC adapter configurations for Cisco ISE and Aruba ClearPass.
 * Provides unified interface for endpoint lookup and quarantine actions.
 */

import { z } from 'zod';
import { CiscoISEAdapter, CiscoISEConfig } from './cisco-ise';
import { ArubaClearPassAdapter, ArubaClearPassConfig } from './aruba-clearpass';
import type { NACAdapter, NACEndpointInfo, NACQuarantineRequest } from '../adapters/types';
import { appendAuditRecord } from '@workspace/audit';

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

/**
 * Apply quarantine to an endpoint
 */
export async function applyQuarantine(
  deviceId: string,
  reason?: string,
  options?: {
    vlan?: string;
    networkProfile?: string;
    correlationId?: string;
  }
): Promise<{ success: boolean; requestId?: string; message?: string }> {
  const adapter = await getNACAdapter();
  
  if (!adapter) {
    const msg = 'NAC not configured';
    await appendAuditRecord('nac.quarantine.failed', { type: 'system' }, {
      meta: { deviceId, reason: 'not_configured', message: msg },
    });
    return { success: false, message: msg };
  }
  
  try {
    const request: NACQuarantineRequest = {
      deviceId,
      action: 'quarantine',
      reason,
      vlan: options?.vlan,
      networkProfile: options?.networkProfile,
      correlationId: options?.correlationId,
    };
    
    const result = await adapter.quarantineEndpoint(request);
    
    await appendAuditRecord('nac.quarantine.applied', { type: 'system' }, {
      meta: { requestId: result.requestId, status: result.status, reason, networkProfile: options?.networkProfile },
    });
    
    return {
      success: true,
      requestId: result.requestId,
      message: result.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    await appendAuditRecord('nac.quarantine.failed', { type: 'system' }, {
      meta: { reason, message },
    });
    
    return { success: false, message };
  }
}

/**
 * Clear quarantine on an endpoint
 */
export async function clearQuarantine(
  deviceId: string,
  reason?: string
): Promise<{ success: boolean; requestId?: string; message?: string }> {
  const adapter = await getNACAdapter();
  
  if (!adapter) {
    const msg = 'NAC not configured';
    await appendAuditRecord('nac.quarantine.cleared', { type: 'system' }, {
      meta: { reason: 'not_configured', message: msg },
    });
    return { success: false, message: msg };
  }
  
  try {
    const result = await adapter.clearQuarantine(deviceId, reason);
    
    await appendAuditRecord('nac.quarantine.cleared', { type: 'system' }, {
      meta: { requestId: result.requestId, status: result.status, reason },
    });
    
    return {
      success: true,
      requestId: result.requestId,
      message: result.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    await appendAuditRecord('nac.quarantine.cleared', { type: 'system' }, {
      meta: { reason, message },
    });
    
    return { success: false, message };
  }
}

/**
 * Health check for NAC
 */
export async function getNACHealthStatus(): Promise<{ provider: string | null; healthy: boolean; message: string }> {
  const config = await getNACConfig();
  
  if (!config?.enabled) {
    return { provider: null, healthy: false, message: 'NAC not enabled' };
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
