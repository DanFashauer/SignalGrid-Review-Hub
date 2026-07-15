/**
 * UEM (Unified Endpoint Management) Store
 * 
 * Manages UEM adapter configurations for Intune, Jamf, and Workspace ONE.
 * Provides a unified interface for device state and actions.
 */

import { z } from 'zod';
import { IntuneAdapter } from './intune';
import { JamfAdapter } from './jamf';
import { WorkspaceONEAdapter } from './workspace-one';
import type { UEMAdapter, UEMDeviceState } from '../adapters/types';

// ============================================================================
// Types
// ============================================================================

export const UEMProviderSchema = z.enum(['intune', 'jamf', 'workspace_one']);
export type UEMProvider = z.infer<typeof UEMProviderSchema>;

export const UEMConfigSchema = z.object({
  provider: UEMProviderSchema,
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});
export type UEMConfig = z.infer<typeof UEMConfigSchema>;

// ============================================================================
// Store
// ============================================================================

const UEM_KEY = 'uem:config';

// In-memory fallback
let inMemoryConfig: UEMConfig | null = null;

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

export async function getUEMConfig(): Promise<UEMConfig | null> {
  const redis = await getRedisClient();
  
  if (redis) {
    try {
      await redis.connect();
      const data = await redis.get(UEM_KEY);
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

export async function setUEMConfig(config: UEMConfig): Promise<void> {
  const redis = await getRedisClient();
  
  if (redis) {
    try {
      await redis.connect();
      await redis.set(UEM_KEY, JSON.stringify(config), 'EX', 86400);
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

let cachedAdapter: UEMAdapter | null = null;

export async function getUEMAdapter(): Promise<UEMAdapter | null> {
  if (cachedAdapter) {
    return cachedAdapter;
  }
  
  const config = await getUEMConfig();
  
  if (!config?.enabled || !config.provider) {
    return null;
  }
  
  // Get credentials from environment
  const provider = config.provider;
  
  switch (provider) {
    case 'intune': {
      const tenantId = process.env.INTUNE_TENANT_ID;
      const clientId = process.env.INTUNE_CLIENT_ID;
      const clientSecret = process.env.INTUNE_CLIENT_SECRET;
      
      if (!tenantId || !clientId || !clientSecret) {
        console.warn('[UEMStore] Intune credentials not configured');
        return null;
      }
      
      cachedAdapter = new IntuneAdapter({
        tenantId,
        clientId,
        clientSecret,
      });
      break;
    }
    
    case 'jamf': {
      const instanceUrl = process.env.JAMF_INSTANCE_URL;
      const username = process.env.JAMF_USERNAME;
      const password = process.env.JAMF_PASSWORD;
      
      if (!instanceUrl || !username || !password) {
        console.warn('[UEMStore] Jamf credentials not configured');
        return null;
      }
      
      cachedAdapter = new JamfAdapter({
        instanceUrl,
        username,
        password,
      });
      break;
    }
    
    case 'workspace_one': {
      const baseUrl = process.env.WORKSPACE_ONE_API_URL;
      const clientId = process.env.WORKSPACE_ONE_CLIENT_ID;
      const clientSecret = process.env.WORKSPACE_ONE_CLIENT_SECRET;
      const tenantId = process.env.WORKSPACE_ONE_TENANT_ID;
      
      if (!baseUrl || !clientId || !clientSecret || !tenantId) {
        console.warn('[UEMStore] Workspace ONE credentials not configured');
        return null;
      }
      
      cachedAdapter = new WorkspaceONEAdapter({
        baseUrl,
        clientId,
        clientSecret,
        tenantId,
      });
      break;
    }
    
    default:
      console.warn(`[UEMStore] Unknown provider: ${provider}`);
      return null;
  }
  
  return cachedAdapter;
}

export async function clearUEMAdapterCache(): Promise<void> {
  cachedAdapter = null;
}

// ============================================================================
// Unified Device Posture
// ============================================================================

/**
 * Unified device posture that normalizes data from any UEM provider
 */
export interface UnifiedDevicePosture {
  platform: 'ios' | 'ipados' | 'macos' | 'android' | 'windows' | 'linux' | 'unknown';
  enrollmentStatus: 'enrolled' | 'not_enrolled' | 'unknown';
  complianceStatus: 'compliant' | 'non_compliant' | 'unknown';
  managementId?: string;
  osVersion?: string;
  patchLevel?: string;
  lastSeenAge?: number; // ms since last sync
  attest: {
    method: 'webauthn' | 'mdm' | 'fleetdm' | 'none';
    confidence: 'high' | 'medium' | 'low';
  };
  signals: {
    jailbreak?: boolean;
    root?: boolean;
    developerMode?: boolean;
  };
  raw?: Record<string, unknown>;
}

/**
 * Get unified device posture from any configured UEM provider
 */
export async function getDevicePosture(deviceId: string): Promise<UnifiedDevicePosture | null> {
  const adapter = await getUEMAdapter();
  
  if (!adapter) {
    return null;
  }
  
  try {
    const state = await adapter.getDeviceState(deviceId);
    
    if (!state) {
      return null;
    }
    
    // Normalize platform
    const platform = normalizePlatform(state.platform || '');
    
    return {
      platform,
      enrollmentStatus: state.enrolled ? 'enrolled' : 'not_enrolled',
      complianceStatus: state.compliant ? 'compliant' : 'non_compliant',
      managementId: state.deviceId,
      osVersion: state.osVersion,
      lastSeenAge: state.lastSync ? Date.now() - new Date(state.lastSync).getTime() : undefined,
      attest: {
        method: 'mdm',
        confidence: state.enrolled ? 'high' : 'low',
      },
      signals: {},
      raw: state as unknown as Record<string, unknown>,
    };
  } catch (error) {
    console.error('[UEMStore] Failed to get device posture:', error);
    return null;
  }
}

/**
 * Normalize platform string to standard values
 */
function normalizePlatform(platform: string): UnifiedDevicePosture['platform'] {
  const p = platform.toLowerCase();
  
  if (p === 'ios') return 'ios';
  if (p === 'ipados') return 'ipados';
  if (p === 'macos' || p === 'darwin') return 'macos';
  if (p === 'android') return 'android';
  if (p === 'windows') return 'windows';
  if (p === 'linux') return 'linux';
  
  return 'unknown';
}

/**
 * Health check for UEM
 */
export async function getUEMHealthStatus(): Promise<{ provider: string | null; healthy: boolean; message: string }> {
  const config = await getUEMConfig();
  
  if (!config?.enabled) {
    return { provider: null, healthy: false, message: 'UEM not enabled' };
  }
  
  const adapter = await getUEMAdapter();
  
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
